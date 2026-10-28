import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StaffProvidersPage } from "./StaffPages";
const state = vi.hoisted(()=>({rows:undefined as undefined | Array<{model:string;sampleSize:number;successRate:number|null;latencyP50Ms:number|null;latencyP95Ms:number|null}>}));
vi.mock("@cinakey/api-client",()=>({useQuery:()=>state.rows}));
afterEach(cleanup);
it("renders metrics, missing data, and model search",()=>{state.rows=[{model:"seedance-2.5",sampleSize:10,successRate:.9,latencyP50Ms:42000,latencyP95Ms:86000},{model:"other",sampleSize:0,successRate:null,latencyP50Ms:null,latencyP95Ms:null}];render(<StaffProvidersPage/>);expect(screen.getByText("90%")).toBeInTheDocument();expect(screen.getByText("42s")).toBeInTheDocument();expect(screen.getByText("86s")).toBeInTheDocument();expect(screen.getAllByText("—")).toHaveLength(3);fireEvent.change(screen.getByLabelText("Search models"),{target:{value:"SEEDANCE"}});expect(screen.queryByText("other")).not.toBeInTheDocument();fireEvent.change(screen.getByLabelText("Search models"),{target:{value:"missing"}});expect(screen.getByRole("status")).toHaveTextContent("No models match");});
it("distinguishes loading from no metrics",()=>{state.rows=undefined;const view=render(<StaffProvidersPage/>);expect(screen.getByRole("status")).toHaveTextContent("Loading provider metrics");state.rows=[];view.rerender(<StaffProvidersPage/>);expect(screen.getByRole("status")).toHaveTextContent("No provider metrics available");});
