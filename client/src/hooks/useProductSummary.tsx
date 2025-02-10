import { useQuery } from "@tanstack/react-query";

const useProductSummary = (selectedItem = "") => {
  const {
    data: productData = [],
    isLoading: productDataLoading,
    refetch,
  } = useQuery({
    queryKey: ["product-data", selectedItem],
    queryFn: async () => {
      const url = selectedItem
        ? `${
            import.meta.env.VITE_API_URL
          }/prod-summary?prodType_id=${selectedItem}`
        : `${import.meta.env.VITE_API_URL}/prod-summary`;
      const res = await fetch(url);
      return res.json();
    },
  });

  return [productData, productDataLoading, refetch];
};

export default useProductSummary;
