import Resolver from "@forge/resolver";
import { getDemoBootstrap } from "./bootstrap";

const resolver = new Resolver();
resolver.define("getBootstrap", () => getDemoBootstrap());

export const handler = resolver.getDefinitions();
