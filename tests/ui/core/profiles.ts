export const PROFILES = [
  { id: 'phone-portrait', label: 'Телефон ↕', width: 390, height: 844, touch: true },
  { id: 'phone-landscape', label: 'Телефон ↔', width: 844, height: 390, touch: true },
  { id: 'tablet-portrait', label: 'Планшет ↕', width: 768, height: 1024, touch: true },
  { id: 'tablet-landscape', label: 'Планшет ↔', width: 1024, height: 768, touch: true },
  { id: 'fullhd', label: 'Full HD', width: 1920, height: 1080, touch: false },
  { id: 'qhd', label: '2K / QHD', width: 2560, height: 1440, touch: false },
  { id: '4k', label: '4K', width: 3840, height: 2160, touch: false },
] as const;
