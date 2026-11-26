/**
 * 本地线性 pairwise 角色匹配打分器。
 *
 * 训练：training/train_linear_pairwise.py（数据全部由大模型生成）。
 * 特征提取必须与 Python 的 feats() 保持完全一致的顺序。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { log } from './common/log';

export interface LinearModel {
  kind: string;
  features: string;
  roles: string[];
  coef: number[];
  intercept: number;
  threshold: number;
}

export interface LinearMember {
  principalId: string;
  name: string;
  principalType: string;
  jobRole?: string;
  department?: string;
}

export interface LinearCandidate {
  avatarId: string;
  ownerId: string;
}

export interface RankRoleInput {
  text: string;
  senderId: string;
  contextLength: number;
  members: LinearMember[];
  candidates: LinearCandidate[];
}

export interface RankRoleResult {
  scores: number[];
  probs: number[];
  top: number;
  threshold: number;
  chosenAvatarId: string | null;
}

type RoleRule = { role: RegExp; text: RegExp };

/** 与 Python ROLE_KEYS 的顺序、正则一致 */
export const ROLE_RULES: Record<string, RoleRule> = {
  产品: { role: /产品/i, text: /产品|PRD|需求|原型|优先级|需求评审|功能定义|字段/i },
  设计: { role: /设计|UI|交互|视觉/i, text: /设计|视觉|UI|交互|样式|按钮|Banner|间距|设计稿/i },
  后端: {
    role: /后端|服务端|架构|技术负责人|研发|开发/i,
    text: /后端|服务端|接口|API|数据库|缓存|回调|分页|签名|验签|架构|服务/i,
  },
  前端: { role: /前端/i, text: /前端|页面|组件|浏览器|H5|加载速度|首屏/i },
  测试: { role: /测试|质量/i, text: /测试|用例|回归|缺陷|BUG|冒烟|验证/i },
  运维: { role: /运维|SRE/i, text: /运维|发布|部署|监控|告警|回滚|证书|权限|上线/i },
  项目: {
    role: /项目|PMO|经理|管理/i,
    text: /项目|排期|进度|风险|评审|站会|会议|待办|协调|里程碑|计划/i,
  },
  市场: {
    role: /市场|运营|品牌|内容|活动|渠道|增长|媒介|投放/i,
    text: /市场|运营|品牌|活动|渠道|增长|推广|内容|投放|曝光|物料|海报/i,
  },
  销售: { role: /销售|商务|客户|商机/i, text: /销售|商务|合同|报价|签约|回款|商机|打单|投标/i },
  数据: {
    role: /数据|分析|ETL|数仓|BI/i,
    text: /数据|报表|指标|分析|埋点|BI|ETL|数仓|看板|宽表|分区/i,
  },
  算法: { role: /算法|机器学习|AI/i, text: /算法|模型|训练|推理|特征|精度|AUC|推荐|召回/i },
  财务: { role: /财务|会计/i, text: /财务|预算|报销|发票|成本|结算|付款|账期|税务/i },
  人力: { role: /人力|人事|HR|招聘|行政/i, text: /人力|招聘|绩效|培训|入职|组织|薪酬|考勤|面试/i },
  法务: { role: /法务|合规|隐私/i, text: /法务|合规|隐私|条款|协议|法律|监管/i },
  客服: {
    role: /客服|客户成功|售后|技术支持/i,
    text: /客服|用户|工单|投诉|售后|反馈|满意度|续费|退换/i,
  },
  安全: { role: /安全|渗透/i, text: /安全|漏洞|渗透|攻击|越权|加密|密钥|等保|安全扫描/i },
  供应链: {
    role: /采购|供应链|供应商|仓储|仓库/i,
    text: /采购|供应商|比价|询价|物料|库存|物流|到货/i,
  },
  交付: { role: /实施|交付|解决方案/i, text: /实施|交付|客户现场|部署|验收|方案|驻场/i },
  移动端: {
    role: /Android|iOS|客户端|移动端|Flutter|React Native/i,
    text: /Android|iOS|客户端|App|移动端|Flutter|React Native|安卓|苹果/i,
  },
  文案: { role: /文案|编辑/i, text: /文案|标题|脚本|推文|宣传语|稿子|措辞/i },
  网络: { role: /网络/i, text: /网络|带宽|专线|路由|交换机|DNS|CDN|网络故障/i },
};

const NEED =
  /[?？]|吗|呢|怎么|什么|多少|是否|能不能|帮我|帮忙|请|麻烦|确认|处理|安排|看一下|看下|急|马上|尽快|今天|今晚|明天|中午前|下班前|下午|周五|拉一下|核一遍|核一下|过一下|给个|发一下|出一下|处理下|跟进|对一下|跑一下|查一下|改一下|调一下|整理一下/;
const QUESTION = /[?？]|吗|呢|怎么|什么|多少|是否|能不能|确认下|看下/;
const NOTICE_CUE =
  /同步|知悉|好消息|已确认|已发送|已归档|已完成|已上线|已发布|已记录|收尾|按计划|推进即可|大家辛苦|就行|供参考/;
const REQUEST_CUE =
  /请|麻烦|帮我|帮忙|看下|看一下|确认下|确认一下|能否|能不能|是否|吗|[?？]|需要你|你这边|跟进|发一下|发我|给个|拉一下|核一下|核对|过一下|查一下|整理一下|处理下|跑一下|同步下|同步一声|尽快|务必|提前|出报告|跑完|修完|定下来/;
const TASK = /帮我|请|麻烦|确认|处理|安排|看一下|同步一下|准备|排查|跟进|对接|发一下|定稿|定下来/;

export function hasReplyCue(text: string): boolean {
  if (NOTICE_CUE.test(text) && !REQUEST_CUE.test(text)) return false;
  return NEED.test(text);
}

function len(text: string): number {
  return Array.from(text).length;
}

export function featuresFor(
  model: LinearModel,
  ownerRole: string,
  senderRole: string,
  text: string,
  contextLength: number,
  ownerName: string,
): number[] {
  const present = model.roles.filter((k) => ROLE_RULES[k]?.text.test(text));
  const roleCats = model.roles.filter((k) => ROLE_RULES[k]?.role.test(ownerRole));
  const roleHits = roleCats.filter((k) => present.includes(k));
  const otherHits = present.filter((k) => !roleHits.includes(k));
  const nameHit = ownerName.trim().length > 0 && text.includes(ownerName.trim());
  const f: number[] = [
    1,
    NEED.test(text) ? 1 : 0,
    QUESTION.test(text) ? 1 : 0,
    TASK.test(text) ? 1 : 0,
    text.trim().endsWith('？') || text.trim().endsWith('?') ? 1 : 0,
    Math.min(len(text), 300) / 300,
    Math.min(contextLength, 8) / 8,
    nameHit ? 1 : 0,
    roleHits.length > 0 ? 1 : 0,
    roleHits.length,
    present.length,
    present.length === 0 ? 1 : 0,
    otherHits.length > 0 ? 1 : 0,
    present.length > 0 && roleHits.length === 0 ? 1 : 0,
    nameHit && present.length === 0 ? 1 : 0,
    present.length === 1 && roleHits.length > 0 ? 1 : 0,
    present.length > 1 && roleHits.length > 0 ? 1 : 0,
    roleHits.some((k) => ROLE_RULES[k]?.role.test(senderRole)) ? 1 : 0,
    present.length > 0 && roleHits.length === 0 && nameHit ? 1 : 0,
    roleCats.length,
    roleHits.length > 0 && NEED.test(text) ? 1 : 0,
    roleHits.length > 0 && !NEED.test(text) ? 1 : 0,
    nameHit && NEED.test(text) ? 1 : 0,
    nameHit && !NEED.test(text) ? 1 : 0,
    (roleHits.length > 0 || nameHit) && (QUESTION.test(text) || TASK.test(text)) ? 1 : 0,
    (roleHits.length > 0 || nameHit) && !NEED.test(text) && !QUESTION.test(text) && !TASK.test(text)
      ? 1
      : 0,
  ];
  for (const k of model.roles) f.push(roleCats.includes(k) ? 1 : 0);
  for (const k of model.roles) f.push(roleHits.includes(k) ? 1 : 0);
  for (const k of model.roles) f.push(present.includes(k) ? 1 : 0);
  for (const k of model.roles) f.push(ROLE_RULES[k]?.role.test(senderRole) ? 1 : 0);
  return f;
}

function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

function dot(model: LinearModel, f: number[]): number {
  let s = model.intercept;
  for (let i = 0; i < model.coef.length; i++) s += (model.coef[i] ?? 0) * (f[i] ?? 0);
  return s;
}

let cached: LinearModel | null | undefined;

export function loadLinearModel(path?: string): LinearModel | null {
  if (cached !== undefined && !path) return cached;
  const candidates = [
    path,
    process.env.AI_ROLE_MODEL_PATH,
    fileURLToPath(new URL('./models/linear-pairwise.json', import.meta.url)),
    `${process.cwd()}/training/out/linear-pairwise-llm.json`,
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as LinearModel;
      if (
        Array.isArray(parsed.roles) &&
        Array.isArray(parsed.coef) &&
        parsed.coef.length === 26 + parsed.roles.length * 4 &&
        typeof parsed.intercept === 'number' &&
        typeof parsed.threshold === 'number'
      ) {
        if (!path) cached = parsed;
        return parsed;
      }
      log.warn('linear role model invalid', { path: p });
    } catch {
      // 继续尝试下一个路径；模型不存在时回退规则
    }
  }
  if (!path) cached = null;
  return null;
}

export function rankRoleCandidates(
  input: RankRoleInput,
  model: LinearModel | null = loadLinearModel(),
): RankRoleResult | null {
  if (!model || input.candidates.length === 0) return null;
  const byId = new Map(input.members.map((m) => [m.principalId, m]));
  const sender = byId.get(input.senderId);
  const senderRole = `${sender?.jobRole ?? ''} ${sender?.department ?? ''}`;
  const text = input.text;
  const scores: number[] = [];
  for (const candidate of input.candidates) {
    const observer = byId.get(candidate.avatarId);
    const owner =
      byId.get(candidate.ownerId) ??
      observer ??
      input.members.find((m) => m.name === candidate.ownerId);
    const ownerRole = `${owner?.jobRole ?? observer?.jobRole ?? ''} ${
      owner?.department ?? observer?.department ?? ''
    }`;
    const ownerName = owner?.name ?? observer?.name ?? '';
    const f = featuresFor(model, ownerRole, senderRole, text, input.contextLength, ownerName);
    scores.push(dot(model, f));
  }
  let top = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i]! > scores[top]!) top = i;
  const topScore = scores[top] ?? Number.NEGATIVE_INFINITY;
  const chosen = topScore >= model.threshold ? input.candidates[top]!.avatarId : null;
  return {
    scores,
    probs: scores.map(sigmoid),
    top,
    threshold: model.threshold,
    chosenAvatarId: chosen,
  };
}
