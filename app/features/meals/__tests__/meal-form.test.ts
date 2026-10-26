import { buildMealForm } from "../meal-form";
import type { PreparedPhoto } from "../prepare-photo";

// `File` de expo-file-system: en el dispositivo lee el archivo de `uri`; acá devuelve bytes fijos.
jest.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    name = "3F2A9C.jpg";
    type = "image/jpeg";
    constructor(mockUri: string) {
      this.uri = mockUri;
    }
    async bytes() {
      return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]); // mismo contenido que JPEG
    }
  },
}));

// En el dispositivo, FormData es el de React Native con el parche de Expo y el `fetch` global es
// `expo/fetch`, que arma el multipart con `convertFormDataAsync`. Se prueba con esas mismas piezas:
// en Jest el FormData global es el de Node y el fetch es otro.
type ConvertFormData = (form: FormData) => Promise<{ body: Uint8Array; boundary: string }>;
const NativeFormData = jest.requireActual<{ default: typeof FormData }>(
  "react-native/Libraries/Network/FormData",
).default;
jest
  .requireActual<{ installFormDataPatch(formData: typeof FormData): void }>(
    "expo/src/winter/FormData",
  )
  .installFormDataPatch(NativeFormData);
const { convertFormDataAsync } = jest.requireActual<{ convertFormDataAsync: ConvertFormData }>(
  "expo/src/winter/fetch/convertFormData",
);

const nodeFormData = globalThis.FormData;
beforeAll(() => {
  globalThis.FormData = NativeFormData;
});
afterAll(() => {
  globalThis.FormData = nodeFormData;
});

const photo: PreparedPhoto = {
  uri: "file:///cache/ImageManipulator/3F2A9C.jpg",
  width: 1600,
  height: 1200,
  bytes: 512_000,
};

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02];
const encode = (text: string) => [...new TextEncoder().encode(text)];

describe("buildMealForm", () => {
  it("expo/fetch arma el campo photo con el JPEG leído del archivo", async () => {
    const { body, boundary } = await convertFormDataAsync(buildMealForm({ photo }));

    expect([...body]).toEqual([
      ...encode(
        `--${boundary}\r\n` +
          'content-disposition: form-data; name="photo"; filename="3F2A9C.jpg"\r\n' +
          "content-type: image/jpeg\r\n\r\n",
      ),
      ...JPEG,
      ...encode(`\r\n--${boundary}--\r\n`),
    ]);
  });

  it("el archivo { uri } de React Native no sirve con expo/fetch (lo que fallaba en el dispositivo)", async () => {
    const form = new FormData();
    form.append("photo", { uri: photo.uri, name: "photo.jpg", type: "image/jpeg" } as never);
    await expect(convertFormDataAsync(form)).rejects.toThrow("Unsupported FormDataPart");
  });
});
