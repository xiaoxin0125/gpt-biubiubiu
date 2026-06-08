export default function CustomSelect({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
  className = '',
  menuDirection = 'up',
  openSelect,
  setOpenSelect,
}) {
  const normalizedOptions = options.map((option) => (typeof option === 'string' ? { label: option, value: option } : option));
  const selected = normalizedOptions.find((option) => option.value === value) || normalizedOptions[0];
  const isOpen = openSelect === id && !disabled;

  return (
    <div className={`${className} custom-select-field ${menuDirection === 'up' ? 'is-menu-up' : ''} ${disabled ? 'is-disabled' : ''}`.trim()}>
      {label ? <span>{label}</span> : null}
      <button
        type="button"
        className={isOpen ? 'custom-select-trigger is-open' : 'custom-select-trigger'}
        onClick={() => setOpenSelect((current) => (current === id ? '' : id))}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <strong>{selected?.label || value}</strong>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {isOpen ? (
        <div className="custom-select-menu" role="listbox">
          {normalizedOptions.map((option) => (
            <button
              type="button"
              className={option.value === value ? 'custom-select-option is-active' : 'custom-select-option'}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpenSelect('');
              }}
              role="option"
              aria-selected={option.value === value}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}