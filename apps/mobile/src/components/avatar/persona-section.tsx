import { type Avatar as AvatarProfile, adminApi } from '@chappie/shared';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { Button, Card, Field, Input, Text } from '@/ui';

/** 人设与风格预览。 */
export function PersonaSection({
  avatar,
  onSaved,
}: {
  avatar: AvatarProfile;
  onSaved: (a: AvatarProfile) => void;
}) {
  const t = useTheme();
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
        persona: persona.trim(),
        dailyBudgetUsd: Number(budget) > 0 ? Number(budget) : undefined,
      });
      onSaved(res.avatar);
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
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <FlatList
      data={[0]}
      keyExtractor={() => 'persona'}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 12 }}
      renderItem={() => (
        <View style={{ gap: 12 }}>
          <Card>
            <Text variant="subtitle">分身人设</Text>
            <Field label="名称">
              <Text variant="bodySm" tone="muted">
                {avatar.name} · 跟随你的用户名
              </Text>
            </Field>
            <Field label="人设描述">
              <Input
                value={persona}
                onChangeText={setPersona}
                multiline
                minHeight={100}
                placeholder="例如：你是 Alice 的 AI 分身，语气亲切简洁，回复不超过三句话…"
              />
            </Field>
            <Field label="每日预算（美元）" hint="超出预算后自动档将降级为手动档并通知你">
              <Input value={budget} onChangeText={setBudget} keyboardType="decimal-pad" />
            </Field>
            <Button
              label={saving ? '保存中…' : '保存人设'}
              loading={saving}
              onPress={() => void save()}
              style={{ marginTop: 12 }}
            />
          </Card>

          <Card>
            <Text variant="subtitle">风格预览</Text>
            <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
              输入一句话，看看分身会怎么回复（按当前人设实时生成）。
            </Text>
            <Field>
              <Input
                value={previewText}
                onChangeText={setPreviewText}
                multiline
                minHeight={64}
                placeholder="模拟一条对方发来的消息…"
              />
            </Field>
            <Button
              label={previewing ? '生成中…' : '试一下'}
              variant="outline"
              loading={previewing}
              onPress={() => void preview()}
              style={{ marginTop: 10 }}
            />
            {previewReply ? (
              <View
                style={{
                  marginTop: 10,
                  backgroundColor: t.aiBubble,
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                <Text variant="bodySm" tone="ai" style={{ lineHeight: 19 }}>
                  {previewReply}
                </Text>
              </View>
            ) : null}
          </Card>
        </View>
      )}
    />
  );
}
