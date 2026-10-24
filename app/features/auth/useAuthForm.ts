import { useRef, useState } from "react";
import { ApiError } from "@/services/api-error";
import type { ApiErrorCode } from "@/services/api-error";
import { errorMessage } from "@/services/error-messages";
import type { ErrorMessageOverrides } from "@/services/error-messages";
import { validateForm } from "./validation";
import type { FormErrors, FormSchema, FormValues, ValidationResult } from "./validation";

export interface AuthFormOptions<F extends string> {
  schema: FormSchema<F>;
  initialValues: NoInfer<FormValues<F>>;
  onSubmit(values: FormValues<F>): Promise<void>;
  messages?: ErrorMessageOverrides;
  fieldErrors?: Partial<Record<ApiErrorCode, NoInfer<F>>>;
  externalError?: unknown;
}

export function useAuthForm<F extends string>({
  schema,
  initialValues,
  onSubmit,
  messages,
  fieldErrors,
  externalError,
}: AuthFormOptions<F>) {
  const [values, setValues] = useState<FormValues<F>>(initialValues);
  const [validationErrors, setValidationErrors] = useState<FormErrors<F>>({});
  const [serverErrors, setServerErrors] = useState<FormErrors<F>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  function showError(error: unknown) {
    const field = error instanceof ApiError ? fieldErrors?.[error.code] : undefined;
    const message = errorMessage(error, messages);
    if (field) {
      const errors: FormErrors<F> = {};
      errors[field] = message;
      setServerErrors(errors);
      setFormError(null);
    } else {
      setServerErrors({});
      setFormError(message);
    }
  }

  const [shownExternalError, setShownExternalError] = useState<unknown>(undefined);
  if (externalError !== shownExternalError) {
    setShownExternalError(externalError);
    if (externalError) showError(externalError);
  }

  function change(field: F, value: string) {
    const next: FormValues<F> = { ...values, [field]: value };
    setValues(next);
    if (serverErrors[field]) setServerErrors((current) => ({ ...current, [field]: undefined }));
    const result = validateForm(schema, next);
    setValidationErrors((current) => keepStillFailing(current, result));
  }

  function blur(field: F) {
    const result = validateForm(schema, values);
    const message = result.ok ? undefined : result.errors[field];
    setValidationErrors((current) => ({ ...current, [field]: message }));
  }

  async function runSubmit() {
    if (inFlight.current) return;
    const result = validateForm(schema, values);
    if (!result.ok) {
      setValidationErrors(result.errors);
      setServerErrors({});
      setFormError(null);
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setValidationErrors({});
    setServerErrors({});
    setFormError(null);
    try {
      await onSubmit(result.data);
    } catch (error) {
      showError(error);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function submit() {
    void runSubmit();
  }

  function field(name: F) {
    return {
      value: values[name],
      onChangeText: (value: string) => change(name, value),
      onBlur: () => blur(name),
      error: validationErrors[name] ?? serverErrors[name],
    };
  }

  return { values, formError, submitting, submit, field };
}

function keepStillFailing<F extends string>(
  current: FormErrors<F>,
  result: ValidationResult<F>,
): FormErrors<F> {
  if (result.ok) return {};
  const kept: FormErrors<F> = {};
  for (const key of Object.keys(current) as F[]) {
    if (current[key] && result.errors[key]) kept[key] = current[key];
  }
  return kept;
}
