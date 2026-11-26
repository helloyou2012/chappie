/**
 * 角色匹配规则（无 GPU 兜底）：
 * 只在「会话成员带职位/部门」的工作群里启用。
 * 从消息文本识别职责关键词，命中观察者主人的职位/部门时允许其分身回复；
 * 被点名的主人直接命中；没有职责线索时只让项目经理分身接一般问题。
 */
export interface RoleMember {
  principalId: string;
  name: string;
  principalType: string;
  ownerId?: string | null;
  jobRole?: string;
  department?: string;
}

export interface RoleCandidate {
  avatarId: string;
  ownerId: string;
  via: string;
}

const ROLE_RULES: { role: RegExp; text: RegExp }[] = [
  { role: /产品/i, text: /产品|PRD|需求|原型|优先级|需求评审|交互稿/i },
  { role: /设计|UI|视觉/i, text: /设计|视觉|UI|交互|样式|按钮|Banner|间距/i },
  { role: /后端|服务端|研发/i, text: /后端|接口|API|数据库|缓存|回调|分页|服务端/i },
  { role: /前端/i, text: /前端|页面|组件|样式|loading|浏览器/i },
  { role: /测试|质量/i, text: /测试|用例|回归|BUG|缺陷|冒烟|验证/i },
  { role: /运维/i, text: /运维|监控|发布|回滚|证书|权限|告警|上线/i },
  { role: /项目|经理|管理/i, text: /项目|排期|进度|风险|评审|站会|会议|待办|协调/i },
];

export function hasRoleMetadata(members: RoleMember[]): boolean {
  return members.some(
    (m) => m.principalType === 'human' && ((m.jobRole ?? '').trim() || (m.department ?? '').trim()),
  );
}

/**
 * 返回允许回复的 avatarId 集合；null 表示该会话没有角色信息，不启用规则。
 * 只处理 auto/direct 候选；显式 @ / reply / continuation 由路由与策略处理。
 */
export function matchRoleCandidates(input: {
  text: string;
  senderId: string;
  members: RoleMember[];
  candidates: RoleCandidate[];
  needReply: boolean;
}): string[] | null {
  if (!hasRoleMetadata(input.members)) return null;
  const text = input.text;
  const matchedRules = ROLE_RULES.filter((r) => r.text.test(text));
  const eligible = input.candidates.filter((c) => c.via === 'auto' || c.via === 'direct');
  if (eligible.length === 0) return [];

  const byId = new Map(input.members.map((m) => [m.principalId, m]));
  const allowed = new Set<string>();

  for (const candidate of eligible) {
    const owner =
      byId.get(candidate.ownerId) ??
      input.members.find((m) => m.principalId === candidate.avatarId);
    if (!owner) continue;
    const role = `${owner.jobRole ?? ''} ${owner.department ?? ''}`;
    const name = owner.name.trim();
    const named = name.length > 0 && text.includes(name);
    const roleHit = matchedRules.some((r) => r.role.test(role));
    if (named || roleHit) allowed.add(candidate.avatarId);
  }

  // 没有职责关键词、也没有点名：一般性问题交给项目经理分身；其余沉默
  if (allowed.size === 0 && matchedRules.length === 0 && input.needReply) {
    for (const candidate of eligible) {
      const owner = byId.get(candidate.ownerId);
      if (owner && /项目|经理|管理/.test(`${owner.jobRole ?? ''} ${owner.department ?? ''}`)) {
        allowed.add(candidate.avatarId);
        break;
      }
    }
  }
  return [...allowed];
}
