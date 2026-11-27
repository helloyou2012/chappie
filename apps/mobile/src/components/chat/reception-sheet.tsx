import { type ConversationView, type ReceptionStrategy, STRATEGY_LABELS } from '@chappie/shared';
import { View } from 'react-native';
import { BottomSheet, Button, Text } from '@/ui';

const STRATEGIES: ReceptionStrategy[] = [
  'summon',
  'assist',
  'full',
  'screen',
  'decline',
  'escalate',
  'silent',
];

/** 接待方式抽屉：真人 / 分身、策略、临时托管与接管。 */
export function ReceptionSheet({
  visible,
  onClose,
  view,
  onChangeReception,
  onTakeover,
  onRelease,
}: {
  visible: boolean;
  onClose: () => void;
  view: ConversationView | undefined;
  onChangeReception: (
    state: 'human' | 'avatar',
    strategy: ReceptionStrategy,
    tempHours?: number,
  ) => void;
  onTakeover: () => void;
  onRelease: () => void;
}) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="接待方式"
      description="真人接待时分身只在你召唤或确认草稿时协助；临时托管到期自动回落。"
    >
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
        <Button
          size="sm"
          variant={view?.myReception?.state !== 'avatar' ? 'primary' : 'outline'}
          label="真人接待"
          onPress={() => onChangeReception('human', view?.myReception?.strategy ?? 'assist')}
          style={{ flex: 1 }}
        />
        <Button
          size="sm"
          variant={view?.myReception?.state === 'avatar' ? 'primary' : 'outline'}
          label="分身接待"
          onPress={onRelease}
          style={{ flex: 1 }}
        />
      </View>
      <Text variant="micro" tone="muted" style={{ marginTop: 14 }}>
        分身策略
      </Text>
      {STRATEGIES.map((s) => {
        const active = view?.myReception?.strategy === s;
        return (
          <View
            key={s}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}
          >
            <Button
              size="sm"
              variant={active ? 'primary' : 'outline'}
              label={`${STRATEGY_LABELS[s] ?? s}${active ? '（当前）' : ''}`}
              onPress={() => onChangeReception('avatar', s)}
              style={{ flex: 1 }}
            />
            <Button
              size="sm"
              variant="outline"
              fullWidth={false}
              label="临时 2h"
              onPress={() => onChangeReception('avatar', s, 2)}
            />
          </View>
        );
      })}
      <Button
        variant="outline"
        tone="warning"
        label="接管对话（暂停分身并冷却 15 分钟）"
        onPress={onTakeover}
        style={{ marginTop: 14 }}
      />
    </BottomSheet>
  );
}
