import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { z } from "zod";

type BulletInput = z.infer<typeof api.bullets.create.input>;
type BulletUpdateInput = z.infer<typeof api.bullets.update.input>;

export function useBullets(experienceId: string) {
  return useQuery({
    queryKey: [api.bullets.listByExperience.path, experienceId],
    queryFn: async () => {
      const url = buildUrl(api.bullets.listByExperience.path, { experienceId });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch bullets");
      return api.bullets.listByExperience.responses[200].parse(await res.json());
    },
    enabled: !!experienceId,
  });
}

export function useCreateBullet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ experienceId, ...data }: { experienceId: string } & BulletInput) => {
      const url = buildUrl(api.bullets.create.path, { experienceId });
      const res = await fetch(url, {
        method: api.bullets.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create bullet");
      return api.bullets.create.responses[201].parse(await res.json());
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: [api.bullets.listByExperience.path, variables.experienceId] 
      });
    },
  });
}

export function useUpdateBullet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, experienceId, ...updates }: { id: string, experienceId: string } & BulletUpdateInput) => {
      const url = buildUrl(api.bullets.update.path, { id });
      const res = await fetch(url, {
        method: api.bullets.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update bullet");
      return api.bullets.update.responses[200].parse(await res.json());
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: [api.bullets.listByExperience.path, variables.experienceId] 
      });
    },
  });
}

export function useDeleteBullet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string, experienceId: string }) => {
      const url = buildUrl(api.bullets.delete.path, { id });
      const res = await fetch(url, {
        method: api.bullets.delete.method,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete bullet");
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: [api.bullets.listByExperience.path, variables.experienceId] 
      });
    },
  });
}

