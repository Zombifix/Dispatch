import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Angle, BulletVariant, CvLanguage, ProfileVariant } from "@shared/schema";

export const ANGLE_OPTIONS: { value: Angle; label: string }[] = [
  { value: "ic", label: "Craft / delivery" },
  { value: "lead", label: "Lead / vision" },
  { value: "consultant", label: "Conseil" },
  { value: "manager", label: "Management" },
];
export const LANGUAGE_OPTIONS: CvLanguage[] = ["FR", "EN"];

const KEY = ["/api/variants"];

export function useVariants() {
  return useQuery<{ bulletVariants: BulletVariant[]; profileVariants: ProfileVariant[] }>({
    queryKey: KEY,
    queryFn: async () => (await apiRequest("GET", "/api/variants")).json(),
  });
}

export function useSaveBulletVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { bulletId: string; angle: Angle; language: CvLanguage; text: string; source?: "user" | "suggested" }) =>
      (await apiRequest("PUT", `/api/bullets/${v.bulletId}/variants`, { angle: v.angle, language: v.language, text: v.text, source: v.source })).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteBulletVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/bullet-variants/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSuggestVariants() {
  return useMutation({
    mutationFn: async (v: { bulletId: string; targets: { angle: Angle; language: CvLanguage }[] }) =>
      (await apiRequest("POST", `/api/bullets/${v.bulletId}/variants/suggest`, { targets: v.targets })).json() as Promise<{
        proposals: { angle: Angle; language: CvLanguage; text: string }[];
        rejected: { angle: string; language: string; reason?: string }[];
      }>,
  });
}

export function useSaveProfileVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { kind: "title" | "summary"; angle: Angle; language: CvLanguage; text: string }) =>
      (await apiRequest("PUT", "/api/profile/variants", v)).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteProfileVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/profile-variants/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
