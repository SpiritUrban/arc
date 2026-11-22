import { z } from "zod";

export const demoUserId = "00000000-0000-4000-8000-000000000001";

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().pipe(z.email()),
});

export const userSchema = profileSchema.extend({ id: z.uuid() });
export const usersSchema = z.array(userSchema);
export type Profile = z.infer<typeof profileSchema>;
export type User = z.infer<typeof userSchema>;
