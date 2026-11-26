import { describe, expect, test } from 'bun:test';
import {
  featuresFor,
  hasReplyCue,
  type LinearModel,
  loadLinearModel,
  ROLE_RULES,
  rankRoleCandidates,
} from '../src/linear-pairwise';
import fixture from './fixtures/linear-feature.json';

const roles = Object.keys(ROLE_RULES);
function modelWith(role: string, threshold = 0.5): LinearModel {
  const coef = Array(26 + roles.length * 4).fill(0);
  coef[26 + roles.length + roles.indexOf(role)] = 1;
  return {
    kind: 'linear-pairwise',
    features: 'role-match-v2',
    roles,
    coef,
    intercept: 0,
    threshold,
  };
}

describe('linear pairwise role model', () => {
  test('production model loads with matching role layout', () => {
    const model = loadLinearModel();
    expect(model).not.toBeNull();
    expect(model!.roles).toEqual(Object.keys(ROLE_RULES));
    expect(model!.coef).toHaveLength(26 + model!.roles.length * 4);
  });

  test('feature layout matches training', () => {
    const model = modelWith('产品');
    const f = featuresFor(
      model,
      '产品经理 产品部',
      '测试工程师 质量部',
      '请产品确认下需求',
      3,
      '李娜',
    );
    expect(f).toHaveLength(26 + roles.length * 4);
    expect(f[1]).toBe(1);
    expect(f[8]).toBe(1);
  });

  test('matches Python feature vector', () => {
    const model: LinearModel = {
      kind: 'linear-pairwise',
      features: 'role-match-v2',
      roles: fixture.roles,
      coef: Array(26 + fixture.roles.length * 4).fill(0),
      intercept: 0,
      threshold: 0,
    };
    const f = featuresFor(
      model,
      fixture.input.ownerRole,
      fixture.input.senderRole,
      fixture.input.text,
      fixture.input.contextLength,
      fixture.input.ownerName,
    );
    expect(f).toEqual(fixture.features);
  });

  test('separates closed notices from requests', () => {
    expect(
      hasReplyCue('同步一下：这周迭代范围已经冻结，需求清单已发到共享文档，大家按排期推进即可。'),
    ).toBe(false);
    expect(hasReplyCue('跟大家同步个好消息：场地、物料、预算都确认完毕，筹备进入收尾阶段。')).toBe(
      false,
    );
    expect(hasReplyCue('王强，支付回调这块接口今天下班前麻烦再核对一遍。')).toBe(true);
  });

  test('chooses the role that owns the request', () => {
    const model = modelWith('产品');
    const members = [
      {
        principalId: 'u1',
        name: '李娜',
        principalType: 'human',
        jobRole: '产品经理',
        department: '产品部',
      },
      {
        principalId: 'a1',
        name: '李娜',
        principalType: 'avatar',
        jobRole: '产品经理',
        department: '产品部',
      },
      {
        principalId: 'u2',
        name: '王强',
        principalType: 'human',
        jobRole: '后端工程师',
        department: '研发部',
      },
      {
        principalId: 'a2',
        name: '王强',
        principalType: 'avatar',
        jobRole: '后端工程师',
        department: '研发部',
      },
      {
        principalId: 'u3',
        name: '赵磊',
        principalType: 'human',
        jobRole: '测试工程师',
        department: '质量部',
      },
      {
        principalId: 'a3',
        name: '赵磊',
        principalType: 'avatar',
        jobRole: '测试工程师',
        department: '质量部',
      },
    ];
    const result = rankRoleCandidates(
      {
        text: '请产品确认下需求，今天要定稿。',
        senderId: 'u3',
        contextLength: 2,
        members,
        candidates: [
          { avatarId: 'a1', ownerId: 'u1' },
          { avatarId: 'a2', ownerId: 'u2' },
        ],
      },
      model,
    );
    expect(result?.chosenAvatarId).toBe('a1');
    expect(result!.scores[0]).toBeGreaterThan(result!.scores[1]!);
  });

  test('silences when below threshold', () => {
    const model = modelWith('产品', 2);
    const members = [
      {
        principalId: 'u1',
        name: '李娜',
        principalType: 'human',
        jobRole: '产品经理',
        department: '产品部',
      },
      {
        principalId: 'a1',
        name: '李娜',
        principalType: 'avatar',
        jobRole: '产品经理',
        department: '产品部',
      },
      {
        principalId: 'u2',
        name: '赵磊',
        principalType: 'human',
        jobRole: '测试工程师',
        department: '质量部',
      },
    ];
    const result = rankRoleCandidates(
      {
        text: '请产品确认下需求。',
        senderId: 'u2',
        contextLength: 1,
        members,
        candidates: [{ avatarId: 'a1', ownerId: 'u1' }],
      },
      model,
    );
    expect(result?.chosenAvatarId).toBeNull();
  });
});
