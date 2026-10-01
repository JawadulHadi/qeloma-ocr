import { File, FileImage, FileSpreadsheet, FileText, FileType, Presentation, type LucideIcon } from 'lucide-react';
import type { FileKind } from '../../shared/types';

function iconFor(kind: FileKind | undefined, mimeType: string): LucideIcon {
  switch (kind) {
    case 'image':
      return FileImage;
    case 'pdf':
      return FileText;
    case 'text':
      return FileType;
    case 'office':
      if (/sheet|excel/i.test(mimeType)) return FileSpreadsheet;
      if (/presentation|powerpoint/i.test(mimeType)) return Presentation;
      return FileText;
    default:
      return File;
  }
}

export function FileIcon({ kind, mimeType = '', size = 18 }: { kind?: FileKind; mimeType?: string; size?: number }) {
  const Icon = iconFor(kind, mimeType);
  return <Icon size={size} aria-hidden="true" />;
}
