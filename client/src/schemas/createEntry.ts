import { z } from "zod";

export const uploadVideoSchema = z.object({
  title: z.string({
    required_error: "Amount is required",
  }),
  description: z.string({ required_error: "Please add description" }),
  tags: z.string({ required_error: "Add tags for better seo" }),
});

