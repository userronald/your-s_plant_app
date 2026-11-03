const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_COMPRESSED_BYTES = 850 * 1024;
const MAX_EDGE_LENGTH = 1280;

function readSignature(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error("Could not inspect the selected image."));
        return;
      }
      resolve(new Uint8Array(reader.result));
    };
    reader.onerror = () => reject(new Error("Could not inspect the selected image."));
    reader.readAsArrayBuffer(file.slice(0, 8));
  });
}

async function validateSourceImage(file: File): Promise<void> {
  const mimeType = file.type.toLowerCase();
  if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp") {
    throw new Error("Choose a JPEG, PNG, or WEBP photo.");
  }
  if (file.size < 1 || file.size > MAX_SOURCE_BYTES) {
    throw new Error("Choose an image smaller than 20 MB.");
  }
  const bytes = await readSignature(file);
  const validJpeg = mimeType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const validPng = mimeType === "image/png" && bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const validWebp = mimeType === "image/webp" && bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!validJpeg && !validPng && !validWebp) throw new Error("The file contents do not match a supported image type.");
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This image could not be opened. Try another JPEG or PNG photo."));
    };
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The photo could not be compressed. Try a different image."));
    }, "image/jpeg", quality);
  });
}

export async function prepareIdentificationPhoto(file: File): Promise<File> {
  await validateSourceImage(file);
  const image = await loadImage(file);
  if (image.naturalWidth < 1 || image.naturalHeight < 1) {
    throw new Error("The selected image has invalid dimensions.");
  }
  if (file.size <= MAX_COMPRESSED_BYTES && Math.max(image.naturalWidth, image.naturalHeight) <= MAX_EDGE_LENGTH) {
    return file;
  }

  const scale = Math.min(1, MAX_EDGE_LENGTH / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser cannot prepare this photo for identification.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let blob: Blob | undefined;
  for (const quality of [0.9, 0.82, 0.72, 0.62, 0.52]) {
    blob = await canvasBlob(canvas, quality);
    if (blob.size <= MAX_COMPRESSED_BYTES) break;
  }
  if (!blob || blob.size > MAX_COMPRESSED_BYTES) {
    throw new Error("This photo is still too large after compression. Choose a smaller image.");
  }
  const name = file.name.replace(/\.(jpe?g|png|webp)$/i, "") || "plant-photo";
  return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
}
