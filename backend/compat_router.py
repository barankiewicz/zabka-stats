import re
import inspect
from typing import Any, Optional
from litestar import Router, get, post, put, delete
from litestar.response import Response as LitestarResponse
from litestar.exceptions import HTTPException as LitestarHTTPException

class Response(LitestarResponse):
    """Compatibility wrapper for Response class."""
    pass

class HTTPException(LitestarHTTPException):
    """Compatibility wrapper for HTTPException class."""
    def __init__(self, status_code: int, detail: str = ""):
        super().__init__(status_code=status_code, detail=detail)

def convert_path_params(path: str, func) -> str:
    """Converts FastAPI-style path parameters e.g., {location_id}
    to Litestar-style typed path parameters e.g., {location_id:int}
    by inspecting the handler function's type annotations."""
    try:
        sig = inspect.signature(func)
    except Exception:
        return path

    params = re.findall(r"\{([a-zA-Z0-9_]+)\}", path)
    new_path = path
    for param in params:
        param_type = "str"
        if param in sig.parameters:
            ann = sig.parameters[param].annotation
            ann_str = str(ann).lower()
            if "int" in ann_str:
                param_type = "int"
            elif "float" in ann_str:
                param_type = "float"
        new_path = new_path.replace(f"{{{param}}}", f"{{{param}:{param_type}}}")
    return new_path

def ensure_annotations(func):
    """Ensures that the handler function has necessary type annotations
    for both parameters and the return value to satisfy Litestar's requirements."""
    try:
        sig = inspect.signature(func)
        # Update missing or default-None param annotations
        for param_name, param in sig.parameters.items():
            if param_name == "self":
                continue
            
            if param_name not in func.__annotations__:
                func.__annotations__[param_name] = Any
            elif param.default is None:
                curr_type = func.__annotations__[param_name]
                # If it's already Optional/Union, don't wrap it again
                if curr_type is not Any:
                    func.__annotations__[param_name] = Optional[curr_type]
    except Exception:
        pass
    if "return" not in func.__annotations__:
        func.__annotations__["return"] = Any
    return func

class APIRouter:
    """Compatibility wrapper that translates FastAPI's APIRouter interface
    to Litestar's Router architecture under the hood. It collects route handlers
    and lifecyle hooks so they can be registered on a Litestar instance."""
    
    def __init__(self, prefix: str = "", tags: list = None):
        self.prefix = prefix
        self.tags = tags or []
        self.handlers = []
        self.startup_handlers = []

    def get(self, path: str, **kwargs):
        def decorator(func):
            func = ensure_annotations(func)
            clean_path = convert_path_params(path, func)
            if clean_path != "/" and clean_path.endswith("/"):
                clean_path = clean_path.rstrip("/")
            handler = get(path=clean_path)(func)
            self.handlers.append(handler)
            return func
        return decorator

    def post(self, path: str, **kwargs):
        def decorator(func):
            func = ensure_annotations(func)
            clean_path = convert_path_params(path, func)
            if clean_path != "/" and clean_path.endswith("/"):
                clean_path = clean_path.rstrip("/")
            handler = post(path=clean_path)(func)
            self.handlers.append(handler)
            return func
        return decorator

    def put(self, path: str, **kwargs):
        def decorator(func):
            func = ensure_annotations(func)
            clean_path = convert_path_params(path, func)
            if clean_path != "/" and clean_path.endswith("/"):
                clean_path = clean_path.rstrip("/")
            handler = put(path=clean_path)(func)
            self.handlers.append(handler)
            return func
        return decorator

    def delete(self, path: str, **kwargs):
        def decorator(func):
            func = ensure_annotations(func)
            clean_path = convert_path_params(path, func)
            if clean_path != "/" and clean_path.endswith("/"):
                clean_path = clean_path.rstrip("/")
            handler = delete(path=clean_path)(func)
            self.handlers.append(handler)
            return func
        return decorator

    def on_event(self, event_type: str):
        def decorator(func):
            if event_type == "startup":
                self.startup_handlers.append(func)
            return func
        return decorator

    def to_litestar_router(self, base_prefix: str = ""):
        # Determine the full combined prefix path
        full_path = base_prefix
        if self.prefix:
            full_path = f"{base_prefix}/{self.prefix.lstrip('/')}".rstrip('/')
            
        if not full_path.startswith("/"):
            full_path = f"/{full_path}"
            
        if full_path != "/" and full_path.endswith("/"):
            full_path = full_path.rstrip("/")
            
        return Router(
            path=full_path,
            route_handlers=self.handlers,
            tags=self.tags
        )
