/**
 * INPUT:  existing internal Core codec imports
 * OUTPUT: the unchanged TSC1 public codec surface
 * POS:    core/secrets — compatibility entry; implementation lives in the boot-free codec package
 */
export {
  SECRET_CATALOG_FORMAT_VERSION, SecretCatalogError, generateCatalogKey, isSecretCatalogKey,
  openCatalog, sealCatalog, sodiumReady,
  type SecretCatalogEntry, type SecretCatalogPlain, type SecretCatalogFailureReason,
} from "@taki/secret-catalog-codec";
