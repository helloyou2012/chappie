import { type Avatar, adminApi } from '@chappie/shared';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { RiLoader4Line, RiMagicLine, RiSaveLine } from '@remixicon/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

export function PersonaTab({ avatar, onSaved }: { avatar: Avatar; onSaved: (a: Avatar) => void }) {
  const [name, setName] = useState(avatar.name);
  const [persona, setPersona] = useState(avatar.persona);
  const [budget, setBudget] = useState(String(avatar.dailyBudgetUsd));
  const [saving, setSaving] = useState(false);

  const [previewText, setPreviewText] = useState('明天上午有空吗？想约你聊一下合作。');
  const [previewReply, setPreviewReply] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await adminApi.updateAvatar({
        name: name.trim() || undefined,
        persona: persona.trim(),
        dailyBudgetUsd: Number(budget) > 0 ? Number(budget) : undefined,
      });
      onSaved(res.avatar);
      toast.success('已保存', '新的人设将从下一条消息开始生效');
    } catch (e) {
      toast.error('保存失败', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const preview = async () => {
    if (!previewText.trim()) return;
    setPreviewing(true);
    setPreviewReply(null);
    try {
      const res = await adminApi.preview(previewText.trim());
      setPreviewReply(res.reply);
    } catch (e) {
      toast.error('预览失败', e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <SparklesIcon className="size-4 text-primary" /> 分身人设
          </CardTitle>
          <CardDescription>
            决定分身的身份、语气与行为边界。人设会进入提示词的最上层。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">分身名称</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">人设描述</label>
            <Textarea
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              rows={6}
              placeholder="例如：你是 Alice 的 AI 分身，语气亲切简洁，回复不超过三句话…"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">每日预算（美元）</label>
            <Input
              type="number"
              min="0"
              step="0.1"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              超出预算后自动档将降级为手动档并通知你。
            </p>
          </div>
          <Button onClick={() => void save()} disabled={saving} className="w-full">
            {saving ? (
              <RiLoader4Line className="size-4 animate-spin" />
            ) : (
              <RiSaveLine className="size-4" />
            )}
            保存人设
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <RiMagicLine className="size-4 text-primary" /> 风格预览
          </CardTitle>
          <CardDescription>输入一句话，看看分身会怎么回复（按当前人设实时生成）。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            rows={3}
            placeholder="模拟一条对方发来的消息…"
          />
          <Button variant="outline" onClick={() => void preview()} disabled={previewing}>
            {previewing ? (
              <RiLoader4Line className="size-4 animate-spin" />
            ) : (
              <RiMagicLine className="size-4" />
            )}
            试一下
          </Button>
          {previewReply ? (
            <div className="rounded-md border bg-ai p-3 text-sm text-ai-foreground whitespace-pre-wrap">
              {previewReply}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
