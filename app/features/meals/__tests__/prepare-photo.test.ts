import { ImageManipulator } from "expo-image-manipulator";
import { exceedsMaxBytes, JPEG_QUALITY, PHOTO_MAX_BYTES, preparePhoto } from "../prepare-photo";

// Manipulador falso: `manipulate` desde una uri "carga" una imagen de `mockSource` (ya orientada)
// y desde otra imagen parte de su tamaño; `resize` cambia el tamaño que sale del render.
const mockSource = { width: 4032, height: 3024 };
const mockSaved: { format?: string; compress?: number }[] = [];
let mockBytes: number | null = 900_000;

interface MockRef {
  width: number;
  height: number;
  saveAsync(options: { format?: string; compress?: number }): Promise<object>;
}

interface MockContext {
  resize: jest.Mock<MockContext, [{ width: number; height: number }]>;
  renderAsync(): Promise<MockRef>;
}

jest.mock("expo-image-manipulator", () => {
  const ref = (width: number, height: number): MockRef => ({
    width,
    height,
    async saveAsync(options) {
      mockSaved.push(options);
      return { uri: `file:///cache/${width}x${height}.jpg`, width, height };
    },
  });
  return {
    SaveFormat: { JPEG: "jpeg" },
    ImageManipulator: {
      manipulate: jest.fn((source: string | MockRef) => {
        let size = typeof source === "string" ? { ...mockSource } : { ...source };
        const context: MockContext = {
          resize: jest.fn((target: { width: number; height: number }) => {
            size = target;
            return context;
          }),
          renderAsync: async () => ref(size.width, size.height),
        };
        return context;
      }),
    },
  };
});

jest.mock("expo-file-system", () => ({
  File: class {
    get size() {
      return mockBytes;
    }
  },
}));

const manipulate = jest.mocked(ImageManipulator.manipulate);
const resizes = () =>
  manipulate.mock.results.flatMap(
    ({ value }) => (value as { resize: jest.Mock }).resize.mock.calls[0] ?? [],
  );

beforeEach(() => {
  manipulate.mockClear();
  mockSaved.length = 0;
  Object.assign(mockSource, { width: 4032, height: 3024 });
  mockBytes = 900_000;
});

describe("preparePhoto", () => {
  it("una foto grande se lleva a 1600 px de lado mayor y se exporta a JPEG", async () => {
    await expect(preparePhoto("file:///camera/raw.heic")).resolves.toEqual({
      uri: "file:///cache/1600x1200.jpg",
      width: 1600,
      height: 1200,
      bytes: 900_000,
    });
    expect(manipulate.mock.calls[0][0]).toBe("file:///camera/raw.heic");
    expect(resizes()).toEqual([{ width: 1600, height: 1200 }]);
    expect(mockSaved).toEqual([{ format: "jpeg", compress: JPEG_QUALITY }]);
  });

  it("respeta la orientación: una foto en retrato queda en retrato", async () => {
    Object.assign(mockSource, { width: 3024, height: 4032 });
    const photo = await preparePhoto("file:///camera/raw.jpg");
    expect(resizes()).toEqual([{ width: 1200, height: 1600 }]);
    expect(photo).toMatchObject({ width: 1200, height: 1600 });
  });

  it("una foto chica no se redimensiona, pero igual se exporta a JPEG", async () => {
    Object.assign(mockSource, { width: 1200, height: 900 });
    const photo = await preparePhoto("file:///galeria/chica.png");
    expect(resizes()).toEqual([]);
    expect(photo).toMatchObject({ uri: "file:///cache/1200x900.jpg", width: 1200, height: 900 });
    expect(mockSaved).toEqual([{ format: "jpeg", compress: JPEG_QUALITY }]);
  });
});

describe("exceedsMaxBytes", () => {
  const photo = { uri: "file:///x.jpg", width: 1600, height: 1200 };

  it("pasa de 8 MB solo si el peso supera el tope", () => {
    expect(exceedsMaxBytes({ ...photo, bytes: PHOTO_MAX_BYTES })).toBe(false);
    expect(exceedsMaxBytes({ ...photo, bytes: PHOTO_MAX_BYTES + 1 })).toBe(true);
  });

  it("si no se pudo leer el peso no bloquea: la API igual lo valida", () => {
    expect(exceedsMaxBytes({ ...photo, bytes: null })).toBe(false);
  });
});
