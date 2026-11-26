/**
 * 从消息正文解析 @昵称，补齐 mentions 数组（AI 路由用）。
 *
 * 背景：群成员里真人和其 AI 分身通常同名（如 alice 与 alice 的分身），
 * 客户端手动输入 @alice 时不一定写入 mentions。这里按昵称兜底：
 *   - 已有显式 mention 的昵称不再解析（尊重客户端选择：@真人 = 不让 AI 抢答）
 *   - 否则优先选发送者自己的分身，其次任意分身，最后才是真人
 *   - 最长昵称优先，避免「小明」误匹配「小明子」
 */
export interface MentionMember {
  principalId: string;
  principalType: string;
  ownerId: string | null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function resolveMentionIds(opts: {
  text: string;
  senderId: string;
  mentions: string[];
  members: MentionMember[];
  names: Map<string, string>;
}): string[] {
  const ids = [...new Set(opts.mentions)];
  const existing = new Set(ids);
  const groups = new Map<string, MentionMember[]>();
  for (const m of opts.members) {
    const name = opts.names.get(m.principalId)?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }

  let haystack = opts.text;
  const ordered = [...groups.entries()].sort((a, b) => {
    const an = opts.names.get(a[1][0]!.principalId) ?? '';
    const bn = opts.names.get(b[1][0]!.principalId) ?? '';
    return bn.length - an.length;
  });

  for (const [, group] of ordered) {
    const first = group[0];
    if (!first) continue;
    // 显式选择了这个昵称下的某个成员（真人或分身），以客户端为准
    if (group.some((m) => existing.has(m.principalId))) continue;
    const name = opts.names.get(first.principalId) ?? '';
    const re = new RegExp(`(?<![A-Za-z0-9_])@${escapeRegExp(name)}(?![A-Za-z0-9_])`, 'iu');
    if (!re.test(haystack)) continue;
    const chosen =
      group.find((m) => m.principalType === 'avatar' && m.ownerId === opts.senderId) ??
      group.find((m) => m.principalType === 'avatar') ??
      first;
    if (!existing.has(chosen.principalId)) {
      ids.push(chosen.principalId);
      existing.add(chosen.principalId);
    }
    // 消费掉这次匹配，避免短昵称重复命中
    haystack = haystack.replace(re, ' '.repeat(name.length + 1));
  }
  return ids;
}
