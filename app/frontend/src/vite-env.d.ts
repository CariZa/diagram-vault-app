/// <reference types="vite/client" />

declare module 'turndown-plugin-gfm' {
  import TurndownService from 'turndown'
  export const gfm: TurndownService.Plugin
}
