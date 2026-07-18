import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fa from '../locales/fa.json';

void i18n.use(initReactI18next).init({
  resources: { fa: { translation: fa } },
  lng: 'fa',
  fallbackLng: 'fa',
  interpolation: { escapeValue: false },
});

document.documentElement.lang = 'fa';
document.documentElement.dir = 'rtl';

export default i18n;
