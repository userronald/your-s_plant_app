const IMAGE_LIMIT_BYTES = 8 * 1024 * 1024;

function readSignature(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error("Could not read the image file signature."));
        return;
      }
      resolve(new Uint8Array(reader.result));
    };
    reader.onerror = () => reject(new Error("Could not read the image file signature."));
    reader.readAsArrayBuffer(file.slice(0, 12));
  });
}

export async function validatePlantPhoto(file: File): Promise<void> {
  const supported = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!supported.has(file.type.toLowerCase())) throw new Error("Choose a JPG, PNG, or WEBP image.");
  if (file.size < 1 || file.size > IMAGE_LIMIT_BYTES) throw new Error("Choose an image no larger than 8 MB.");

  const bytes = await readSignature(file);
  const isJpeg = file.type.toLowerCase() === "image/jpeg"
    && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = file.type.toLowerCase() === "image/png"
    && bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const isWebp = file.type.toLowerCase() === "image/webp"
    && bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!isJpeg && !isPng && !isWebp) throw new Error("The file contents do not match a supported image type.");
}
