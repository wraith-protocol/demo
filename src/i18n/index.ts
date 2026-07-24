import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './en.json';
import es from './es.json';
import pt from './pt.json';
import fr from './fr.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      pt: { translation: pt },
      fr: { translation: fr },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'es', 'pt', 'fr'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      // Check localStorage first, then navigator.language
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'wraith-locale',
    },
  });

export default i18n;
