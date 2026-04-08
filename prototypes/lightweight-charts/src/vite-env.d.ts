/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROTO_BUILD_STAMP: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'virtual:ar-proto-build-stamp.css' {}
