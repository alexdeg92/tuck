export type DatePickerProps = {
  label: string;

  value: string | null;
  onChange: (next: string | null) => void;
  isDisabled?: boolean;

  min?: string;
  max?: string;
};
