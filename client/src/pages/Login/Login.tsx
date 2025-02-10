import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form } from "@/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { loginSchema } from "@/schemas/login";
import { useContext } from "react";
import { AuthContext } from "@/providers/AuthProvider";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bounce, toast } from "react-toastify";

const Login = () => {
  const { logInUser } = useContext(AuthContext)!;

  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/";

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form;

  async function onSubmit(data: z.infer<typeof loginSchema>) {
    try {
      await logInUser(data.email, data.password);
      toast.success("Successfully logged in!", { position: "top-right", autoClose: 1000, transition: Bounce });
      navigate(from, { replace: true });
    } catch (error) {
      toast.error(error.response?.data?.message || "Login failed", { position: "top-right", autoClose: 1000, transition: Bounce });
    }
  }

  return (
    <div className="h-screen flex justify-center items-center">
      <Card className="w-[350px]">
        <CardHeader className="text-center">
          <CardTitle>Login</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={handleSubmit(onSubmit)}>
              <div className="grid w-full items-center gap-4">
                <div className="flex flex-col space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" placeholder="you@example.com" {...register("email")} />
                  {errors.email && <p className="text-red-500">{errors.email.message}</p>}
                </div>

                <div className="flex flex-col space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input type="password" id="password" placeholder="******" {...register("password")} />
                  {errors.password && <p className="text-red-500">{errors.password.message}</p>}
                </div>

                <Button type="submit">Login</Button>
              </div>
            </form>
            <p className="my-2 text-center">
              New here? <Link className="font-semibold" to="/register">Create account</Link>
            </p>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
