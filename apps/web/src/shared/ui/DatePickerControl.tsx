import {
  getLocalTimeZone,
  parseDate,
  today,
  type CalendarDate,
  type DateValue,
} from '@internationalized/date';
import { CalendarDays, ChevronLeft, ChevronRight, CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from 'react-aria-components/Button';
import { Calendar, CalendarCell, CalendarGrid } from 'react-aria-components/Calendar';
import { DateInput, DateSegment } from 'react-aria-components/DateField';
import { DatePicker as AriaDatePicker } from 'react-aria-components/DatePicker';
import { Dialog } from 'react-aria-components/Dialog';
import { Group } from 'react-aria-components/Group';
import { Heading } from 'react-aria-components/Heading';
import { Label } from 'react-aria-components/Label';
import { Popover } from 'react-aria-components/Popover';
import { Text } from 'react-aria-components/Text';
import { cx } from '../lib/cx';
import type { DatePickerProps } from './datePickerProps';
import styles from './DatePicker.module.css';

const isComplete = (date: DateValue): boolean => date.year >= 1000;

/**
 * A stored YYYY-MM-DD as a calendar date, or null when it can't be shown faithfully: the date
 * library reads year 0000 as year 1, and showing a different date would be worse than none.
 */
function readDate(value: string): CalendarDate | null {
  try {
    const date = parseDate(value);
    return date.toString() === value ? date : null;
  } catch {
    return null;
  }
}
const toDate = (value: string | null): CalendarDate | null =>
  value === null ? null : readDate(value);

export default function DatePickerControl({
  label,
  value,
  onChange,
  isDisabled = false,
  min,
  max,
}: DatePickerProps) {
  const minDate = min === undefined ? undefined : parseDate(min);
  const maxDate = max === undefined ? undefined : parseDate(max);
  const inRange = (date: DateValue) =>
    (minDate === undefined || date.compare(minDate) >= 0) &&
    (maxDate === undefined || date.compare(maxDate) <= 0);
  const range =
    minDate !== undefined && maxDate !== undefined
      ? `Use a date between ${String(minDate.year)} and ${String(maxDate.year)}.`
      : 'Use a valid date.';
  const [open, setOpen] = useState(false);

  const [left, setLeft] = useState(false);

  const [draft, setDraft] = useState<DateValue | null>(() => toDate(value));
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setDraft(toDate(value));
  }

  const unreadable = value !== null && toDate(value) === null;

  const outOfRange =
    draft !== null && (isComplete(draft) || left || draft.toString() === value) && !inRange(draft);
  const problem = unreadable
    ? `The saved date ${value} can’t be shown. ${range}`
    : outOfRange
      ? range
      : null;

  function commit(next: DateValue | null) {
    setDraft(next);
    const text = next === null ? null : next.toString();
    if (text !== value) onChange(text);
  }

  return (
    <AriaDatePicker
      className={cx(styles.picker)}
      value={draft}
      granularity="day"
      isDisabled={isDisabled}
      isInvalid={problem !== null}
      {...(minDate === undefined ? {} : { minValue: minDate })}
      {...(maxDate === undefined ? {} : { maxValue: maxDate })}
      isOpen={open}
      onOpenChange={setOpen}

      onChange={(next) => {
        if (next === null || (isComplete(next) && inRange(next))) {
          commit(next);
          return;
        }
        setDraft(next);
      }}
    >
      <Label className={cx(styles.label)}>{label}</Label>
      <Group className={cx(styles.group)}>
        <span
          className={cx(styles.segments)}
          onFocus={() => {
            setLeft(false);
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setLeft(true);
          }}
        >
          <DateInput className={cx(styles.input)}>
            {(segment) => <DateSegment segment={segment} className={cx(styles.segment)} />}
          </DateInput>
        </span>
        <Button className={cx(styles.trigger)} aria-label="Choose due date">
          <CalendarDays aria-hidden="true" />
        </Button>
      </Group>
      {problem !== null ? (
        <Text slot="errorMessage" className={cx(styles.error)}>
          <CircleAlert aria-hidden="true" />
          {problem}
        </Text>
      ) : null}
      <Popover className={cx(styles.popover)} offset={4}>
        <Dialog className={cx(styles.dialog)} aria-label="Choose due date">
          <Calendar className={cx(styles.calendar)}>
            <header className={cx(styles.calendarHead)}>
              <Button slot="previous" className={cx(styles.nav)}>
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Heading className={cx(styles.heading)} />
              <Button slot="next" className={cx(styles.nav)}>
                <ChevronRight aria-hidden="true" />
              </Button>
            </header>
            {}
            <div className={styles.weeks}>
              <CalendarGrid className={cx(styles.grid)}>
                {(date) => <CalendarCell date={date} className={cx(styles.day)} />}
              </CalendarGrid>
            </div>
          </Calendar>
          <footer className={cx(styles.calendarFoot)}>
            <Button
              className={cx(styles.footAction)}
              onPress={() => {
                commit(today(getLocalTimeZone()));
                setOpen(false);
              }}
            >
              Today
            </Button>
            <Button
              className={cx(styles.footAction)}
              data-tone="quiet"
              onPress={() => {
                commit(null);
                setOpen(false);
              }}
            >
              Clear date
            </Button>
          </footer>
        </Dialog>
      </Popover>
    </AriaDatePicker>
  );
}
