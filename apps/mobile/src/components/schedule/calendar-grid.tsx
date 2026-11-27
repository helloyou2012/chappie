import type { CalendarItem, dayjs } from '@chappie/shared';
import type { ComponentRef, RefObject } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { Text } from '@/ui';
import {
  END_HOUR,
  GRID_HEIGHT,
  GUTTER,
  HOUR_HEIGHT,
  START_HOUR,
  TZ_LABEL,
  topOf,
  WEEKDAYS,
} from './meta';

/** 三日时间轴（飞书日历形态）：星期/日期头 + 时刻网格 + 当前时刻红线。 */
export function CalendarGrid({
  days,
  dayKeys,
  todayKey,
  nowMinutes,
  eventsForDay,
  gridRef,
  refreshing,
  onRefresh,
  onEvent,
}: {
  days: ReturnType<typeof dayjs>[];
  dayKeys: string[];
  todayKey: string;
  nowMinutes: number;
  eventsForDay: (key: string) => { item: CalendarItem; index: number }[];
  gridRef: RefObject<ComponentRef<typeof ScrollView> | null>;
  refreshing: boolean;
  onRefresh: () => void;
  onEvent: (item: CalendarItem, index: number) => void;
}) {
  const t = useTheme();
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const showNow = nowMinutes >= START_HOUR * 60 && nowMinutes <= END_HOUR * 60;

  return (
    <>
      {/* 星期 / 日期头：列宽与下方网格严格对齐 */}
      <View style={{ flexDirection: 'row', paddingBottom: 6 }}>
        <View
          style={{
            width: GUTTER,
            justifyContent: 'flex-end',
            alignItems: 'flex-start',
            paddingLeft: 8,
          }}
        >
          <Text variant="micro" tone="tertiary">
            {TZ_LABEL}
          </Text>
        </View>
        {days.map((day, index) => {
          const active = dayKeys[index] === todayKey;
          return (
            <View key={dayKeys[index]} style={{ flex: 1, alignItems: 'center', gap: 3 }}>
              <Text variant="caption" tone="muted">
                {WEEKDAYS[day.day()]}
              </Text>
              <Text
                style={{
                  fontSize: 22,
                  fontWeight: active ? '700' : '500',
                  color: active ? t.primary : t.text,
                  letterSpacing: -0.3,
                }}
              >
                {day.date()}
              </Text>
            </View>
          );
        })}
      </View>

      <ScrollView
        ref={gridRef}
        style={{ flex: 1 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />
        }
        contentContainerStyle={{ paddingBottom: 96 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ height: GRID_HEIGHT + 12, position: 'relative' }}>
          {hours.map((h) => (
            <View
              key={h}
              style={{
                position: 'absolute',
                top: (h - START_HOUR) * HOUR_HEIGHT,
                left: 0,
                right: 0,
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <Text
                variant="micro"
                tone="tertiary"
                style={{ width: GUTTER, textAlign: 'right', paddingRight: 8 }}
              >
                {String(h).padStart(2, '0')}:00
              </Text>
              <View
                style={{
                  flex: 1,
                  height: StyleSheet.hairlineWidth,
                  backgroundColor: t.separator,
                }}
              />
            </View>
          ))}

          <View
            style={{
              position: 'absolute',
              left: GUTTER,
              right: 0,
              top: 0,
              bottom: 0,
              flexDirection: 'row',
            }}
          >
            {days.map((_day, index) => {
              const key = dayKeys[index]!;
              const isToday = key === todayKey;
              return (
                <View
                  key={key}
                  style={{
                    flex: 1,
                    position: 'relative',
                    borderLeftWidth: index > 0 ? StyleSheet.hairlineWidth : 0,
                    borderLeftColor: t.separator,
                  }}
                >
                  {eventsForDay(key).map(({ item, index: calIndex }) => {
                    const [hh, mm] = item.time.split(':').map(Number);
                    const top = topOf((hh ?? 0) * 60 + (mm ?? 0));
                    if (top < 0 || top > GRID_HEIGHT) return null;
                    return (
                      <EventBlock
                        key={item.id ?? `${item.time}-${item.title}`}
                        item={item}
                        top={top}
                        onPress={() => onEvent(item, calIndex)}
                      />
                    );
                  })}
                  {isToday && showNow ? (
                    <View
                      style={{
                        position: 'absolute',
                        top: topOf(nowMinutes),
                        left: 0,
                        right: 0,
                        flexDirection: 'row',
                        alignItems: 'center',
                      }}
                    >
                      <View
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 4,
                          backgroundColor: t.danger,
                          marginLeft: -3,
                        }}
                      />
                      <View style={{ flex: 1, height: 1.5, backgroundColor: t.danger }} />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </>
  );
}

function EventBlock({
  item,
  top,
  onPress,
}: {
  item: CalendarItem;
  top: number;
  onPress: () => void;
}) {
  const t = useTheme();
  const cancelled = item.status === 'cancelled';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.time} ${item.title}`}
      onPress={onPress}
      style={({ pressed }) => ({
        position: 'absolute',
        top,
        left: 3,
        right: 3,
        height: 30,
        borderRadius: 6,
        backgroundColor: cancelled ? t.surfaceRaised : `${t.primary}1a`,
        opacity: pressed ? 0.75 : 1,
        overflow: 'hidden',
        flexDirection: 'row',
        alignItems: 'center',
      })}
    >
      <View
        style={{
          width: 3,
          alignSelf: 'stretch',
          backgroundColor: cancelled ? t.textTertiary : t.primary,
        }}
      />
      <Text
        variant="micro"
        numberOfLines={1}
        style={{
          flex: 1,
          marginLeft: 5,
          marginRight: 3,
          color: cancelled ? t.textMuted : t.primary,
          fontWeight: '600',
          textDecorationLine: cancelled ? 'line-through' : 'none',
        }}
      >
        {item.time} {item.title}
      </Text>
    </Pressable>
  );
}
