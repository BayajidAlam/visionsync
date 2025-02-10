import { useQuery } from "@tanstack/react-query";

const useTransactionTypes = () => {
  const {
    data: transactionTypes = [],
    isLoading: transactionTypesLoading,
    refetch,
  } = useQuery({
    queryKey: ["trans-type"],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/trans-type`);
      return res.json();
    },
  });
  return [transactionTypes, transactionTypesLoading, refetch];
};

export default useTransactionTypes;
