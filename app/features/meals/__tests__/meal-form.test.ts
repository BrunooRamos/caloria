import { buildMealForm } from "../meal-form";
import type { PreparedPhoto } from "../prepare-photo";

// `File` de expo-file-system: en el dispositivo lee el archivo de `uri`; acá devuelve bytes fijos
// según la extensión.
jest.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    name: string;
    type: string;
    constructor(mockUri: string) {
      this.uri = mockUri;
      this.name = mockUri.slice(mockUri.lastIndexOf("/") + 1);
      this.type = mockUri.endsWith(".m4a") ? "audio/mp4" : "image/jpeg";
    }
    async bytes() {
      return this.type === "audio/mp4"
        ? new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]) // `....ftyp`
        : new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]); // mismo contenido que JPEG
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

const audio = { uri: "file:///cache/ExpoAudio/7B1E44.m4a" };

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02];
const M4A = [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70];
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

  it("con audio, manda la foto y el M4A en el mismo multipart", async () => {
    const { body, boundary } = await convertFormDataAsync(buildMealForm({ photo, audio }));

    expect([...body]).toEqual([
      ...encode(
        `--${boundary}\r\n` +
          'content-disposition: form-data; name="photo"; filename="3F2A9C.jpg"\r\n' +
          "content-type: image/jpeg\r\n\r\n",
      ),
      ...JPEG,
      ...encode(
        `\r\n--${boundary}\r\n` +
          'content-disposition: form-data; name="audio"; filename="7B1E44.m4a"\r\n' +
          "content-type: audio/mp4\r\n\r\n",
      ),
      ...M4A,
      ...encode(`\r\n--${boundary}--\r\n`),
    ]);
  });

  it("sin audio no agrega el campo", () => {
    const form = buildMealForm({ photo });
    expect(form.getAll("audio")).toEqual([]);
    expect(form.getAll("photo")).toHaveLength(1);
  });

  it("el archivo { uri } de React Native no sirve con expo/fetch (lo que fallaba en el dispositivo)", async () => {
    const form = new FormData();
    form.append("photo", { uri: photo.uri, name: "photo.jpg", type: "image/jpeg" } as never);
    await expect(convertFormDataAsync(form)).rejects.toThrow("Unsupported FormDataPart");
  });
});
