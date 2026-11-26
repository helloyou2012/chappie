import { Node } from '@tiptap/core';

/**
 * 行内 @ 提及节点：以标签（chip）整体展示与删除。
 * 序列化为 `@昵称` 文本，保证消费端拿到的仍是普通文本。
 */
export const MentionNode = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-id') ?? '',
        renderHTML: (attrs) => ({ 'data-id': attrs.id }),
      },
      label: {
        default: '',
        parseHTML: (el) =>
          el.getAttribute('data-label') ?? (el.textContent ?? '').replace(/^@/, ''),
        renderHTML: (attrs) => ({ 'data-label': attrs.label }),
      },
      kind: {
        default: 'human',
        parseHTML: (el) => el.getAttribute('data-kind') ?? 'human',
        renderHTML: (attrs) => ({ 'data-kind': attrs.kind }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="mention"]' }];
  },

  renderHTML({ node }) {
    return [
      'span',
      { 'data-type': 'mention', class: 'mention-chip' },
      `@${String(node.attrs.label ?? '')}`,
    ];
  },

  renderText({ node }) {
    return `@${String(node.attrs.label ?? '')}`;
  },
});
