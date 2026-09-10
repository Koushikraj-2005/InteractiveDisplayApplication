export const VOICE_LANGS = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi / हिन्दी' },
  { code: 'bn', label: 'Bengali / বাংলা' },
  { code: 'ta', label: 'Tamil / தமிழ்' },
];

export function localizedName(item, lang) {
  return (item.names && item.names[lang]) || item.name;
}