import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import pt from "./locales/pt.json";
import en from "./locales/en.json";
import es from "./locales/es.json";

// Idiomas suportados pelo sistema. Adicionar um novo idioma = criar o JSON
// em ./locales e registrar aqui.
export const SUPPORTED_LANGUAGES = ["pt", "en", "es"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

i18n
  .use(LanguageDetector) // detecta o idioma do navegador automaticamente
  .use(initReactI18next)
  .init({
    resources: {
      pt: { translation: pt },
      en: { translation: en },
      es: { translation: es },
    },
    fallbackLng: "pt",
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    nonExplicitSupportedLngs: true, // "en-US" cai em "en", "es-AR" cai em "es" etc.
    interpolation: { escapeValue: false }, // React já escapa por padrão
    detection: {
      // 1) idioma escolhido manualmente e salvo antes; 2) idioma do navegador
      order: ["localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"],
      lookupLocalStorage: "zomini_lang",
    },
  });

export default i18n;
