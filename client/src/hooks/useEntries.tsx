import { useQuery } from "@tanstack/react-query";

const useEntries = () => {
  const {
    data: entries = [],
    isLoading: entryLoading,
    refetch,
  } = useQuery({
    queryKey: ["entries"],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/entry`);
      return res.json();
    },
  });
  return [entries, entryLoading, refetch];
};

export default useEntries;
