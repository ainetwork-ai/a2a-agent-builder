/**
 * Get display name from model name by removing path prefix
 * e.g., "/data/models/gemma-3-27b-it" -> "gemma-3-27b-it"
 */
export function getDisplayModelName(modelName: string): string {
  const lastSlash = modelName.lastIndexOf('/');
  return lastSlash >= 0 ? modelName.substring(lastSlash + 1) : modelName;
}
