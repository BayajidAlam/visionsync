import { useQuery } from "@tanstack/react-query";

const useProductTypes = () => {
  const {
    data: productTypes = [],
    isLoading: productTypesLoading,
    refetch,
  } = useQuery({
    queryKey: ["prod-type"],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/prod-type`);
      return res.json();
    },
  });
  return [productTypes, productTypesLoading, refetch];
};

export default useProductTypes;
