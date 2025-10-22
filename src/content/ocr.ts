// Placeholder OCR module; replace with Tesseract.js integration later.
export async function captureAndOCR(): Promise<string[]> {
  // Ask for tab/screen capture consent and return empty keyword list for now.
  try {
    // Minimal prompt to ensure user intent; real implementation would use getDisplayMedia
    // and Tesseract to produce keywords only.
    console.log("[aws-assist] OCR capture requested");
    return [];
  } catch (e) {
    console.warn("[aws-assist] OCR capture failed", e);
    return [];
  }
}

