// backend/src/common/validation.ts
import validator from "validator";
import xss from "xss";

/**
 * Validation centralisée pour prévenir les injections XSS et valider les entrées
 */

// Configuration XSS plus stricte
const xssOptions = {
  whiteList: {}, // Aucune balise HTML autorisée
  stripIgnoreTag: true,
  stripIgnoreTagBody: ["script", "style"],
};

/**
 * Sanitize une chaîne contre XSS avec limitation de longueur
 */
export function sanitizeString(input: unknown, maxLength: number = 200): string {
  if (typeof input !== "string") {
    throw new Error("Input must be a string");
  }
  
  const trimmed = validator.trim(input);
  const sanitized = xss(trimmed, xssOptions);
  
  if (sanitized.length > maxLength) {
    throw new Error(`Input exceeds maximum length of ${maxLength}`);
  }
  
  return sanitized;
}

/**
 * Validation stricte du username
 * - Longueur: 3-20 caractères
 * - Caractères autorisés: alphanumériques, underscore, tiret
 */
export function validateUsername(input: unknown): string {
  if (typeof input !== "string") {
    throw new Error("Username must be a string");
  }
  
  const cleaned = validator.trim(input);
  
  if (cleaned.length < 3 || cleaned.length > 20) {
    throw new Error("Username must be between 3 and 20 characters");
  }
  
  if (!/^[a-zA-Z0-9_-]+$/.test(cleaned)) {
    throw new Error("Username can only contain letters, numbers, underscore and dash");
  }
  
  // Protection XSS même si regex déjà restrictive
  return xss(cleaned, xssOptions);
}

/**
 * Validation stricte de l'email
 */
export function validateEmail(input: unknown): string {
  if (typeof input !== "string") {
    throw new Error("Email must be a string");
  }
  
  const cleaned = validator.trim(input).toLowerCase();
  
  if (!validator.isEmail(cleaned)) {
    throw new Error("Invalid email format");
  }
  
  if (cleaned.length > 100) {
    throw new Error("Email too long");
  }
  
  // Protection XSS
  return xss(cleaned, xssOptions);
}

/**
 * Validation du mot de passe
 * Note: on ne sanitize PAS le password (il sera hashé)
 * mais on vérifie la longueur et la complexité
 */
export function validatePassword(input: unknown): string {
  if (typeof input !== "string") {
    throw new Error("Password must be a string");
  }
  
  if (input.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  
  if (input.length > 128) {
    throw new Error("Password too long");
  }
  
  // Vérification complexité minimale (au moins 1 chiffre et 1 lettre)
  if (!/[0-9]/.test(input) || !/[a-zA-Z]/.test(input)) {
    throw new Error("Password must contain at least one letter and one number");
  }
  
  return input; // Pas de sanitization, sera hashé
}

/**
 * Validation d'un ID numérique positif
 */
export function validateId(input: unknown): number {
  const id = Number(input);
  
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid ID: must be a positive integer");
  }
  
  if (id > Number.MAX_SAFE_INTEGER) {
    throw new Error("ID exceeds maximum safe integer");
  }
  
  return id;
}

/**
 * Validation d'une URL (avatar, etc.)
 */
export function validateUrl(input: unknown): string {
  if (typeof input !== "string") {
    throw new Error("URL must be a string");
  }
  
  const cleaned = validator.trim(input);
  
  if (cleaned.length > 500) {
    throw new Error("URL too long");
  }
  
  if (!validator.isURL(cleaned, {
    protocols: ["http", "https"],
    require_protocol: true,
  })) {
    throw new Error("Invalid URL format");
  }
  
  // Protection XSS dans l'URL
  return xss(cleaned, xssOptions);
}

/**
 * Validation d'un nombre dans une plage
 */
export function validateNumber(
  input: unknown,
  min: number,
  max: number
): number {
  const num = Number(input);
  
  if (isNaN(num)) {
    throw new Error("Invalid number");
  }
  
  if (num < min || num > max) {
    throw new Error(`Number must be between ${min} and ${max}`);
  }
  
  return num;
}

/**
 * Validation d'une énumération
 */
export function validateEnum<T extends string>(
  input: unknown,
  allowedValues: readonly T[]
): T {
  if (typeof input !== "string") {
    throw new Error("Enum value must be a string");
  }
  
  const cleaned = validator.trim(input);
  
  if (!allowedValues.includes(cleaned as T)) {
    throw new Error(`Value must be one of: ${allowedValues.join(", ")}`);
  }
  
  return cleaned as T;
}

/**
 * Wrapper de validation pour les routes
 * Retourne un objet { success: boolean, data?: T, error?: string }
 */
export function safeValidate<T>(
  fn: () => T
): { success: true; data: T } | { success: false; error: string } {
  try {
    return { success: true, data: fn() };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Validation failed",
    };
  }
}