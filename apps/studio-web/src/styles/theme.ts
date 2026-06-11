import { createTheme, rem } from "@mantine/core";

export const studioTheme = createTheme({
  fontFamily:
    "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  fontFamilyMonospace:
    "JetBrains Mono, SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace",
  primaryColor: "lime",
  defaultRadius: "sm",
  headings: {
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    fontWeight: "700",
    sizes: {
      h1: { fontSize: rem(22), lineHeight: "1.15" },
      h2: { fontSize: rem(16), lineHeight: "1.2" },
      h3: { fontSize: rem(13), lineHeight: "1.2" },
    },
  },
  colors: {
    lime: [
      "#eefdf1",
      "#d9f9df",
      "#afeebc",
      "#83e199",
      "#5ed878",
      "#44d163",
      "#35ce58",
      "#26b548",
      "#1aa23e",
      "#078c30",
    ],
  },
  components: {
    Button: {
      defaultProps: {
        size: "xs",
      },
    },
    Badge: {
      defaultProps: {
        size: "sm",
      },
    },
    ActionIcon: {
      defaultProps: {
        size: "sm",
        variant: "subtle",
      },
    },
  },
});
