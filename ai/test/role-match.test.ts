import { describe, expect, test } from 'bun:test';
import { matchRoleCandidates } from '../src/role-match';

const members = [
  {
    principalId: 'u_proj',
    name: '张伟',
    principalType: 'human',
    ownerId: null,
    jobRole: '项目经理',
    department: '项目管理部',
  },
  {
    principalId: 'a_proj',
    name: '张伟',
    principalType: 'avatar',
    ownerId: 'u_proj',
    jobRole: '项目经理',
    department: '项目管理部',
  },
  {
    principalId: 'u_prod',
    name: '李娜',
    principalType: 'human',
    ownerId: null,
    jobRole: '产品经理',
    department: '产品部',
  },
  {
    principalId: 'a_prod',
    name: '李娜',
    principalType: 'avatar',
    ownerId: 'u_prod',
    jobRole: '产品经理',
    department: '产品部',
  },
  {
    principalId: 'u_be',
    name: '王强',
    principalType: 'human',
    ownerId: null,
    jobRole: '后端开发',
    department: '研发部',
  },
  {
    principalId: 'a_be',
    name: '王强',
    principalType: 'avatar',
    ownerId: 'u_be',
    jobRole: '后端开发',
    department: '研发部',
  },
];
const candidates = [
  { avatarId: 'a_proj', ownerId: 'u_proj', via: 'auto' },
  { avatarId: 'a_prod', ownerId: 'u_prod', via: 'auto' },
  { avatarId: 'a_be', ownerId: 'u_be', via: 'auto' },
];

describe('角色匹配规则', () => {
  test('产品关键词只放行产品分身', () => {
    const allowed = matchRoleCandidates({
      text: 'PRD 的筛选逻辑请产品确认一下',
      senderId: 'u_proj',
      members,
      candidates,
      needReply: true,
    });
    expect(allowed).toEqual(['a_prod']);
  });

  test('点名主人直接放行该分身', () => {
    const allowed = matchRoleCandidates({
      text: '王强看一下这个报错',
      senderId: 'u_proj',
      members,
      candidates,
      needReply: true,
    });
    expect(allowed).toContain('a_be');
  });

  test('没有职责线索的一般问题交给项目经理分身', () => {
    const allowed = matchRoleCandidates({
      text: '这个方案大家觉得怎么样',
      senderId: 'u_prod',
      members,
      candidates,
      needReply: true,
    });
    expect(allowed).toEqual(['a_proj']);
  });

  test('没有角色元数据时不启用', () => {
    const allowed = matchRoleCandidates({
      text: '产品看一下',
      senderId: 'u_x',
      members: members.map((m) => ({ ...m, jobRole: '', department: '' })),
      candidates,
      needReply: true,
    });
    expect(allowed).toBeNull();
  });
});
