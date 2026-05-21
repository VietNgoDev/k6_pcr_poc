export interface ApiRoute {
  Name: string;
  URI: string;
  Method: string; // GET, POST, PUT, PATCH, DELETE etc.
  Auth: 'ADMIN' | 'CONTRACT_HOLDER' | 'NONE';
  Body?: any;
}
