import { splitCitations } from '../../shared/citations';

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

/** Link target that marks a citation; ExternalLink-style renderers turn it into a chip. */
export const CITE_HREF_PREFIX = '#cite-';

/**
 * A remark plugin: [S1] markers in ordinary text become links to "#cite-S1", which the Markdown renderer shows
 * as chips. Code spans and code blocks are not text nodes, so markers inside them are left alone.
 */
export function remarkCitations() {
  const visit = (node: MdNode) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child): MdNode[] => {
      if (child.type !== 'text' || !child.value) {
        if (child.type !== 'link') visit(child);
        return [child];
      }
      return splitCitations(child.value).flatMap((segment): MdNode[] =>
        segment.type === 'text'
          ? [{ type: 'text', value: segment.text }]
          : segment.labels.map((label) => ({
              type: 'link',
              url: `${CITE_HREF_PREFIX}${label}`,
              children: [{ type: 'text', value: label }],
            })),
      );
    });
  };
  return (tree: MdNode) => visit(tree);
}
