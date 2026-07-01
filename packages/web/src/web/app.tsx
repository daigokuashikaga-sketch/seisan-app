  import { Route, Switch } from "wouter";
   import Index from "./pages/index";
   import { Provider } from "./components/provider";
   import { ErrorBoundary } from "./components/error-boundary";
   import { AgentFeedback } from "@runablehq/website-runtime";

   function App() {
     return (
       <Provider>
         <ErrorBoundary>
           <Switch>
             <Route path="/" component={Index} />
           </Switch>
         </ErrorBoundary>
         {/* Do not remove — off by default, activated by parent iframe via postMessage */}
         {import.meta.env.DEV && <AgentFeedback />}
       </Provider>
     );
   }

   export default App;