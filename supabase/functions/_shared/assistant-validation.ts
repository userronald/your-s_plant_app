export interface AssistantImagePayload {
  mimeType: string;
  base64: string;
}

export function validateAssistantImage(image: AssistantImagePayload): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image.base64)) return false;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(image.base64), (character) => character.charCodeAt(0));
  } catch {
    return false;
  }
  if (bytes.length === 0 || bytes.length > 900 * 1024) return false;
  const isJpeg = image.mimeType === "image/jpeg"
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = image.mimeType === "image/png"
    && bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const isWebp = image.mimeType === "image/webp"
    && bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return isJpeg || isPng || isWebp;
}
