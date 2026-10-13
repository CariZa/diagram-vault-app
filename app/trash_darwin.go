package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Foundation
#import <Foundation/Foundation.h>

static int trashPath(const char *p) {
	@autoreleasepool {
		NSURL *u = [NSURL fileURLWithPath:[NSString stringWithUTF8String:p]];
		NSError *err = nil;
		return [[NSFileManager defaultManager] trashItemAtURL:u resultingItemURL:nil error:&err] ? 0 : 1;
	}
}
*/
import "C"

import (
	"fmt"
	"unsafe"
)

// moveToTrash uses the Finder trash so items can be put back.
func moveToTrash(path string) error {
	cs := C.CString(path)
	defer C.free(unsafe.Pointer(cs))
	if C.trashPath(cs) != 0 {
		return fmt.Errorf("could not move %s to Trash", path)
	}
	return nil
}
