export type PlotMeshImageRef = {
  filename?: string;
  name?: string;
  mime?: string;
  url?: string;
  width?: number;
  height?: number;
  weight?: number;
  promptNumber?: number;
};

const IMAGE_HEADER = '__PM_IMAGES__\n';
const FILE_HEADER = '__PM_FILE__\n';

export function extractImagesFromPayload(value: unknown): PlotMeshImageRef[] {
  if (typeof value !== 'string' || !value.startsWith(IMAGE_HEADER)) return [];
  const match = value.match(/^__PM_IMAGES__\n([^\n]*)\n/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed)
      ? parsed.filter((image) => image && typeof image === 'object')
      : [];
  } catch {
    return [];
  }
}

export function buildImagePayload(images: PlotMeshImageRef[], description = 'AI 生成图片'): string {
  const documents = images.map((image, index) => {
    const rawName = image.name || image.filename || `generated-${index + 1}.png`;
    const filename = String(rawName).replace(/"/g, '&quot;');
    return `<document filename="${filename}">\n[${description}，图片资源见 __PM_IMAGES__]\n</document>`;
  });
  return `${IMAGE_HEADER}${JSON.stringify(images)}\n${FILE_HEADER}<documents>\n${documents.join('\n')}\n</documents>`;
}

export function resolveImageUrl(image?: PlotMeshImageRef | null): string {
  const value = image?.url || (image?.filename ? `/uploads/${image.filename}` : '');
  if (!value) return '';
  if (/^(?:data:|blob:|https?:\/\/)/i.test(value)) return value;
  return value.startsWith('/') ? value : `/${value}`;
}

export function stripImageAndFilePayload(value: string): string {
  let output = String(value || '');
  const imageMatch = output.match(/^__PM_IMAGES__\n[^\n]*\n/);
  if (imageMatch) output = output.slice(imageMatch[0].length);
  if (output.startsWith(FILE_HEADER)) output = output.slice(FILE_HEADER.length);
  return output;
}
