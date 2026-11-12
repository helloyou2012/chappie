import { adminApi, formatRelative, type MemoryItem } from '@chappie/shared';
import {
  RiBrainLine,
  RiDeleteBinLine,
  RiEraserLine,
  RiLoader4Line,
  RiSearchLine,
} from '@remixicon/react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

const TYPE_LABEL: Record<string, string> = {
  fact: '事实',
  preference: '偏好',
  commitment: '承诺',
  relationship: '关系',
  procedure: '习惯做法',
  episode: '事件',
};

export function MemoryTab() {
  const [scope, setScope] = useState<'all' | 'global' | 'contact'>('all');
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [forgetting, setForgetting] = useState(false);

  const load = useCallback(async (s: 'all' | 'global' | 'contact') => {
    setLoading(true);
    try {
      const res = await adminApi.listMemories({ scope: s });
      setMemories(res.memories);
    } catch (e) {
      toast.error('加载记忆失败', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(scope);
  }, [scope, load]);

  const remove = async (m: MemoryItem) => {
    try {
      await adminApi.deleteMemory(m.id);
      setMemories((prev) => prev.filter((x) => x.id !== m.id));
      toast.success('已删除记忆');
    } catch (e) {
      toast.error('删除失败', String(e));
    }
  };

  const forget = async () => {
    if (!keyword.trim()) return;
    setForgetting(true);
    try {
      const res = await adminApi.forgetTopic(keyword.trim());
      toast.success(`已忘记 ${res.deleted} 条相关记忆`, `关键词：${keyword.trim()}`);
      setKeyword('');
      await load(scope);
    } catch (e) {
      toast.error('操作失败', String(e));
    } finally {
      setForgetting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm">
            <RiBrainLine className="size-4 text-primary" /> 记忆
          </CardTitle>
          <CardDescription className="mt-1">
            记忆按对话对象隔离；敏感记忆默认不用于对外对话。你可以随时查看、删除或让它「忘记」。
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
            <TabsList>
              <TabsTrigger value="all">全部</TabsTrigger>
              <TabsTrigger value="global">通用</TabsTrigger>
              <TabsTrigger value="contact">联系人</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="ml-auto flex items-center gap-2">
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="忘记某个主题/关键词…"
              inputSize="sm"
              className="w-48"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void forget()}
              disabled={forgetting || !keyword.trim()}
            >
              {forgetting ? (
                <RiLoader4Line className="size-3 animate-spin" />
              ) : (
                <RiEraserLine className="size-3" />
              )}
              忘记
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <RiLoader4Line className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : memories.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-xs text-muted-foreground">
            <RiSearchLine className="size-5" />
            暂无记忆。分身会在对话中逐步学习（承诺、偏好、事实等）。
          </div>
        ) : (
          <div className="space-y-2">
            {memories.map((m) => (
              <div
                key={m.id}
                className="flex items-start gap-3 rounded-md border bg-card px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{TYPE_LABEL[m.type] ?? m.type}</Badge>
                    <Badge variant={m.scope === 'contact' ? 'muted' : 'secondary'}>
                      {m.scope === 'contact' ? '联系人' : '通用'}
                    </Badge>
                    {m.sensitivity === 'sensitive' ? (
                      <Badge variant="destructive">敏感</Badge>
                    ) : null}
                    <span className="text-[10px] text-muted-foreground">
                      置信度 {(m.confidence * 100).toFixed(0)}% · {formatRelative(m.createdAt)}
                    </span>
                  </div>
                  <p
                    className={cn(
                      'mt-1 text-sm',
                      m.sensitivity === 'sensitive' && 'text-muted-foreground',
                    )}
                  >
                    {m.content}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void remove(m)}
                  title="删除这条记忆"
                >
                  <RiDeleteBinLine className="size-3.5 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
