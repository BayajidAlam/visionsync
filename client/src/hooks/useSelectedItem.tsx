import { useQuery } from "@tanstack/react-query";

const useEntryData = (selectedItem: string | null) => {
  if (!selectedItem) {
    return [[], false, null, () => {}];
  }
  console.log(selectedItem);
  const {
    data: data = [],
    isLoading: entryDataLoading,
    refetch: entryRefetch,
    error,
  } = useQuery({
    queryKey: ["entry-data", selectedItem],
    queryFn: async () => {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/entry-data/${selectedItem}`
      );
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data = await res.json();
      return data?.data;
    },
  });
  return [data, entryDataLoading, error, entryRefetch];
};

export default useEntryData;
