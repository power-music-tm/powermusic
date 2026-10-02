import { useState } from 'react';
import { Search } from 'lucide-react';

export default function FilterBar({
  searchPlaceholder = 'Search...',
  onSearchChange,
  filters = [],
  onFilterChange
}) {
  const [openFilterLabel, setOpenFilterLabel] = useState(null);
  const [selectedFilters, setSelectedFilters] = useState({});

  const handleCheckboxChange = (label, option) => {
    const currentSelected = selectedFilters[label] || [];
    let newSelected = [];

    if (currentSelected.includes(option)) {
      newSelected = currentSelected.filter((item) => item !== option);
    } else {
      newSelected = [...currentSelected, option];
    }

    const updated = {
      ...selectedFilters,
      [label]: newSelected
    };

    setSelectedFilters(updated);

    if (typeof onFilterChange === 'function') {
      onFilterChange(updated);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full select-none">
      {/* Search Input Container */}
      <div className="relative flex-1 max-w-sm">
        <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-4 w-4 text-[var(--color-text-secondary)]" />
        </span>
        <input
          type="text"
          placeholder={searchPlaceholder}
          onChange={(e) => typeof onSearchChange === 'function' && onSearchChange(e.target.value)}
          className="block w-full pl-9 pr-3 py-1.5 bg-white border border-[var(--color-border-default)] rounded-md text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-focus)] transition-colors"
          style={{ fontSize: 'var(--font-size-base)' }}
        />
      </div>

      {/* Filters Container */}
      <div className="flex flex-wrap items-center gap-2 relative">
        {openFilterLabel && (
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpenFilterLabel(null)}
          />
        )}

        {filters.map((filter) => {
          const selectedCount = (selectedFilters[filter.label] || []).length;
          const isOpen = openFilterLabel === filter.label;

          return (
            <div key={filter.label} className="relative z-20">
              <button
                onClick={() => setOpenFilterLabel(isOpen ? null : filter.label)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-sm bg-white hover:bg-gray-50 focus:outline-none transition-colors ${
                  isOpen || selectedCount > 0
                    ? 'border-[var(--color-brand-accent)] text-[var(--color-brand-accent)] font-medium'
                    : 'border-[var(--color-border-default)] text-[var(--color-text-primary)]'
                }`}
              >
                <span>{filter.label}</span>
                {selectedCount > 0 && (
                  <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold bg-[var(--color-brand-accent)] text-white rounded-full">
                    {selectedCount}
                  </span>
                )}
                <span className="text-[10px] text-gray-400">▾</span>
              </button>

              {isOpen && (
                <div className="absolute left-0 mt-1.5 w-48 bg-white border border-[var(--color-border-default)] rounded-md shadow-[var(--shadow-card)] py-2 z-30 animate-fade-in">
                  <div className="max-h-48 overflow-y-auto px-3 py-1 space-y-2">
                    {filter.options.map((option) => {
                      const isChecked = (selectedFilters[filter.label] || []).includes(option);

                      return (
                        <label
                          key={option}
                          className="flex items-center gap-2.5 text-sm text-[var(--color-text-primary)] cursor-pointer py-1 px-1.5 rounded hover:bg-gray-50 transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleCheckboxChange(filter.label, option)}
                            className="rounded border-[var(--color-border-default)] text-[var(--color-brand-accent)] focus:ring-[var(--color-brand-accent)] w-3.5 h-3.5 cursor-pointer"
                          />
                          <span className="select-none text-[13px]">{option}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
