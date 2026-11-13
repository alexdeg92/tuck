import { Check, ChevronDown } from 'lucide-react';
import { Button } from 'react-aria-components/Button';
import { Label } from 'react-aria-components/Label';
import { ListBox, ListBoxItem } from 'react-aria-components/ListBox';
import { Popover } from 'react-aria-components/Popover';
import { Select as AriaSelect, SelectValue } from 'react-aria-components/Select';
import { cx } from '../lib/cx';
import type { SelectProps } from './selectProps';
import styles from './Select.module.css';

export default function SelectControl({
  label,
  hideLabel = false,
  options,
  value,
  onChange,
  isDisabled = false,
  compact = false,
  className,
}: SelectProps<string>) {
  const current = options.find((option) => option.value === value);
  return (
    <AriaSelect
      className={cx(styles.select, compact && styles.compact, className)}
      value={value}
      onChange={(key) => {
        const next = options.find((option) => option.value === key);
        if (next !== undefined && next.value !== value) onChange(next.value);
      }}
      isDisabled={isDisabled}
      {...(hideLabel ? { 'aria-label': label } : {})}
    >
      {hideLabel ? null : <Label className={cx(styles.label)}>{label}</Label>}
      <Button className={cx(styles.trigger)} data-tone={current?.tone}>
        <SelectValue className={cx(styles.value)}>
          {() => (
            <>
              {current?.icon}
              {current?.label}
            </>
          )}
        </SelectValue>
        <ChevronDown className={cx(styles.chevron)} aria-hidden="true" />
      </Button>
      <Popover className={cx(styles.popover)} offset={4}>
        <ListBox className={cx(styles.listbox)}>
          {options.map((option) => (
            <ListBoxItem
              key={option.value}
              id={option.value}
              textValue={option.label}
              className={cx(styles.option)}
              data-tone={option.tone}
            >
              <span className={cx(styles.optionLabel)}>
                {option.icon}
                {option.label}
              </span>
              <Check className={cx(styles.optionCheck)} aria-hidden="true" />
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}
